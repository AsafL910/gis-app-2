import { useEffect, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import AddIcon from "@mui/icons-material/Add";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import {
  addAssetsToSet,
  createSet,
  deleteSet,
  deleteSharedGpkg,
  fetchAvailableGpkgs,
  fetchSets,
  getSharedGpkgDownloadUrl,
  renameSharedGpkg,
  updateDtmOrder,
  uploadSharedGpkg
} from "./api";
import type { AvailableGpkgFile, MapSetRecord } from "./types";

const NAV_WIDTH = 280;

interface DraftAsset {
  key: string;
  label: string;
  size: number;
  source: "upload" | "existing";
  file?: File;
  relativePath?: string;
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const clone = [...items];
  const [item] = clone.splice(index, 1);
  clone.splice(targetIndex, 0, item);
  return clone;
}

function toUploadDrafts(files: File[]): DraftAsset[] {
  return files.map((file) => ({
    key: `upload:${file.name}:${file.size}:${file.lastModified}`,
    label: file.name,
    size: file.size,
    source: "upload",
    file
  }));
}

function toExistingDraft(file: AvailableGpkgFile): DraftAsset {
  return {
    key: `existing:${file.relativePath}`,
    label: file.fileName,
    size: file.size,
    source: "existing",
    relativePath: file.relativePath
  };
}

export function App() {
  const [sets, setSets] = useState<MapSetRecord[]>([]);
  const [availableFiles, setAvailableFiles] = useState<AvailableGpkgFile[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maps, setMaps] = useState<DraftAsset[]>([]);
  const [dtms, setDtms] = useState<DraftAsset[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingShared, setIsUploadingShared] = useState(false);
  const [isManagingShared, setIsManagingShared] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AvailableGpkgFile | null>(null);
  const [nextSharedFileName, setNextSharedFileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AvailableGpkgFile | null>(null);
  const [serverOrder, setServerOrder] = useState<Record<string, string[]>>({});

  const selectedSet = sets.find((item) => item.id === selectedSetId) ?? null;

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError("");

    try {
      const [nextSets, nextFiles] = await Promise.all([fetchSets(), fetchAvailableGpkgs()]);
      setSets(nextSets);
      setAvailableFiles(nextFiles);
      setSelectedSetId((current) => current || nextSets[0]?.id || "");
      setServerOrder(
        Object.fromEntries(nextSets.map((item) => [item.id, item.dtmLayers.map((layer) => layer.id)]))
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard data.");
    } finally {
      setIsLoading(false);
    }
  }

  function reorderDraftDtms(index: number, direction: -1 | 1) {
    setDtms((current) => moveItem(current, index, direction));
  }

  function reorderSelectedSet(index: number, direction: -1 | 1) {
    if (!selectedSet) {
      return;
    }

    const currentOrder = serverOrder[selectedSet.id] ?? selectedSet.dtmLayers.map((layer) => layer.id);
    setServerOrder((current) => ({
      ...current,
      [selectedSet.id]: moveItem(currentOrder, index, direction)
    }));
  }

  function addExistingAsset(kind: "map" | "dtm", file: AvailableGpkgFile) {
    const nextItem = toExistingDraft(file);
    const setter = kind === "map" ? setMaps : setDtms;

    setter((current) => {
      if (current.some((item) => item.key === nextItem.key)) {
        return current;
      }

      return [...current, nextItem];
    });
  }

  function appendUploadedAssets(kind: "map" | "dtm", files: File[]) {
    const nextItems = toUploadDrafts(files);
    const setter = kind === "map" ? setMaps : setDtms;

    setter((current) => {
      const existingKeys = new Set(current.map((item) => item.key));
      const deduped = nextItems.filter((item) => !existingKeys.has(item.key));
      return [...current, ...deduped];
    });
  }

  function removeDraftAsset(kind: "map" | "dtm", assetKey: string) {
    const setter = kind === "map" ? setMaps : setDtms;
    setter((current) => current.filter((item) => item.key !== assetKey));
  }

  function resetDraftSelection() {
    setName("");
    setDescription("");
    setMaps([]);
    setDtms([]);
  }

  function buildDraftPayload() {
    return {
      maps: maps.filter((item) => item.source === "upload").flatMap((item) => (item.file ? [item.file] : [])),
      dtms: dtms.filter((item) => item.source === "upload").flatMap((item) => (item.file ? [item.file] : [])),
      selectedMapPaths: maps
        .filter((item) => item.source === "existing")
        .flatMap((item) => (item.relativePath ? [item.relativePath] : [])),
      selectedDtmPaths: dtms
        .filter((item) => item.source === "existing")
        .flatMap((item) => (item.relativePath ? [item.relativePath] : [])),
      dtmSelectionOrder: dtms.map((item) => ({
        source: item.source,
        relativePath: item.relativePath
      }))
    };
  }

  async function handleCreateSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const created = await createSet({
        name,
        description,
        ...buildDraftPayload()
      });

      const nextSets = [created, ...sets];
      setSets(nextSets);
      setSelectedSetId(created.id);
      setServerOrder((current) => ({
        ...current,
        [created.id]: created.dtmLayers.map((layer) => layer.id)
      }));
      resetDraftSelection();
      setSuccess("Map set created and VRT generated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to create map set.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddDraftToSelectedSet() {
    if (!selectedSet) {
      return;
    }

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const updated = await addAssetsToSet(selectedSet.id, buildDraftPayload());
      setSets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setServerOrder((current) => ({
        ...current,
        [updated.id]: updated.dtmLayers.map((layer) => layer.id)
      }));
      resetDraftSelection();
      setSuccess(`Added assets to "${updated.name}" and rebuilt the VRT.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add assets to the selected map set.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePersistOrder() {
    if (!selectedSet) {
      return;
    }

    const dtmIds = serverOrder[selectedSet.id] ?? selectedSet.dtmLayers.map((layer) => layer.id);
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const updated = await updateDtmOrder(selectedSet.id, dtmIds);
      setSets((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setServerOrder((current) => ({
        ...current,
        [updated.id]: updated.dtmLayers.map((layer) => layer.id)
      }));
      setSuccess("DTM priority updated and VRT rebuilt.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update DTM order.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteSet(setId: string) {
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      await deleteSet(setId);
      const nextSets = sets.filter((item) => item.id !== setId);
      setSets(nextSets);
      setSelectedSetId((current) => (current === setId ? nextSets[0]?.id || "" : current));
      setSuccess("Map set deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete map set.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSharedUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    setIsUploadingShared(true);
    setError("");
    setSuccess("");

    try {
      const uploaded = await uploadSharedGpkg(file);
      setAvailableFiles((current) =>
        [...current.filter((item) => item.relativePath !== uploaded.relativePath), uploaded].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )
      );
      setSuccess(`Uploaded ${uploaded.fileName} to shared data.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload shared GeoPackage.");
    } finally {
      setIsUploadingShared(false);
    }
  }

  function openRenameDialog(file: AvailableGpkgFile) {
    setRenameTarget(file);
    setNextSharedFileName(file.fileName);
  }

  async function handleRenameSharedFile() {
    if (!renameTarget) {
      return;
    }

    setIsManagingShared(true);
    setError("");
    setSuccess("");

    try {
      const updated = await renameSharedGpkg(renameTarget.relativePath, nextSharedFileName);
      setAvailableFiles((current) =>
        current
          .map((item) => (item.relativePath === renameTarget.relativePath ? updated : item))
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      );
      setMaps((current) =>
        current.map((item) =>
          item.relativePath === renameTarget.relativePath
            ? {
                ...item,
                key: `existing:${updated.relativePath}`,
                label: updated.fileName,
                size: updated.size,
                relativePath: updated.relativePath
              }
            : item
        )
      );
      setDtms((current) =>
        current.map((item) =>
          item.relativePath === renameTarget.relativePath
            ? {
                ...item,
                key: `existing:${updated.relativePath}`,
                label: updated.fileName,
                size: updated.size,
                relativePath: updated.relativePath
              }
            : item
        )
      );
      setRenameTarget(null);
      setNextSharedFileName("");
      setSuccess(`Renamed shared GeoPackage to ${updated.fileName}.`);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename shared GeoPackage.");
    } finally {
      setIsManagingShared(false);
    }
  }

  async function handleDeleteSharedFile() {
    if (!deleteTarget) {
      return;
    }

    setIsManagingShared(true);
    setError("");
    setSuccess("");

    try {
      await deleteSharedGpkg(deleteTarget.relativePath);
      setAvailableFiles((current) => current.filter((item) => item.relativePath !== deleteTarget.relativePath));
      setMaps((current) => current.filter((item) => item.relativePath !== deleteTarget.relativePath));
      setDtms((current) => current.filter((item) => item.relativePath !== deleteTarget.relativePath));
      setDeleteTarget(null);
      setSuccess(`Deleted shared GeoPackage ${deleteTarget.fileName}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete shared GeoPackage.");
    } finally {
      setIsManagingShared(false);
    }
  }

  const orderedLayers = selectedSet
    ? (serverOrder[selectedSet.id] ?? selectedSet.dtmLayers.map((layer) => layer.id))
        .map((id) => selectedSet.dtmLayers.find((layer) => layer.id === id))
        .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer))
    : [];

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Drawer variant="permanent" sx={{ width: NAV_WIDTH, flexShrink: 0 }}>
        <Toolbar sx={{ minHeight: 88, alignItems: "center" }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 42,
                height: 42,
                display: "grid",
                placeItems: "center",
                borderRadius: 3,
                bgcolor: "rgba(255,255,255,0.12)"
              }}
            >
              <LayersIcon />
            </Box>
            <Box>
              <Typography variant="h6">GIS Console</Typography>
              <Typography variant="body2" sx={{ opacity: 0.72 }}>
                Shared VRT-first workflow
              </Typography>
            </Box>
          </Stack>
        </Toolbar>
        <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
        <List sx={{ px: 2, py: 3 }}>
          <ListItem>
            <ListItemText primary="Map Set Manager" secondary="Pick, upload, order, publish DTMs" />
          </ListItem>
          <ListItem>
            <ListItemText primary="Terrain Service" secondary="Consumes generated VRTs from data/" />
          </ListItem>
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1 }}>
        <AppBar
          position="static"
          color="transparent"
          elevation={0}
          sx={{ borderBottom: "1px solid rgba(15, 118, 110, 0.08)", backdropFilter: "blur(8px)" }}
        >
          <Toolbar sx={{ minHeight: 88 }}>
            <Box>
              <Typography variant="h4">Map Sets</Typography>
              <Typography variant="body2" color="text.secondary">
                Shared `data/` source of truth, explicit DTM priority, generated GDAL VRT output.
              </Typography>
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3 }}>
          <Stack spacing={3}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {success ? <Alert severity="success">{success}</Alert> : null}

            <Stack direction={{ xs: "column", xl: "row" }} spacing={3} alignItems="stretch">
              <Card sx={{ flex: 1.15 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                    <Box>
                      <Typography variant="h6">Registered Sets</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Existing map sets and generated VRT references.
                      </Typography>
                    </Box>
                    <Button variant="outlined" onClick={() => void loadDashboard()} disabled={isLoading}>
                      Refresh
                    </Button>
                  </Stack>

                  <TableContainer sx={{ width: "100%", overflowX: "auto" }}>
                    <Table size="small" sx={{ minWidth: 720 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Maps</TableCell>
                          <TableCell>DTMs</TableCell>
                          <TableCell>VRT</TableCell>
                          <TableCell align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sets.map((mapSet) => (
                          <TableRow
                            key={mapSet.id}
                            hover
                            selected={mapSet.id === selectedSetId}
                            sx={{ cursor: "pointer" }}
                            onClick={() => setSelectedSetId(mapSet.id)}
                          >
                            <TableCell sx={{ minWidth: 180 }}>
                              <Typography fontWeight={700}>{mapSet.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {mapSet.description || "No description"}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>{mapSet.maps.length}</TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>{mapSet.dtmLayers.length}</TableCell>
                            <TableCell sx={{ minWidth: 240 }}>
                              <Typography variant="caption">{mapSet.vrtPath}</Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                              <IconButton
                                color="error"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDeleteSet(mapSet.id);
                                }}
                              >
                                <DeleteOutlineIcon />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!sets.length && !isLoading ? (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <Typography color="text.secondary">
                                No map sets yet. Create the first one from the wizard.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>

              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="h6">Create VRT Set</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    First ingest GeoPackages into the shared catalog. Then compose a VRT set by referencing catalog files in the order you want.
                  </Typography>

                  <Box component="form" onSubmit={handleCreateSet}>
                    <Stack spacing={2.5}>
                      <TextField
                        label="Set Name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        fullWidth
                      />
                      <TextField
                        label="Description"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        fullWidth
                        multiline
                        minRows={2}
                      />

                      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                        <Button component="label" variant="outlined" startIcon={<CloudUploadOutlinedIcon />} fullWidth>
                          Upload Map Files to Catalog
                          <input
                            hidden
                            type="file"
                            multiple
                            accept=".gpkg"
                            onChange={(event) => appendUploadedAssets("map", Array.from(event.target.files ?? []))}
                          />
                        </Button>
                        <Button
                          component="label"
                          variant="outlined"
                          color="secondary"
                          startIcon={<CloudUploadOutlinedIcon />}
                          fullWidth
                        >
                          Upload DTM Files to Catalog
                          <input
                            hidden
                            type="file"
                            multiple
                            accept=".gpkg"
                            onChange={(event) => appendUploadedAssets("dtm", Array.from(event.target.files ?? []))}
                          />
                        </Button>
                      </Stack>

                      <Card variant="outlined">
                        <CardContent sx={{ pb: "16px !important" }}>
                          <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 1.5 }}>
                            <FolderOutlinedIcon fontSize="small" />
                            <Box>
                              <Typography variant="subtitle1" fontWeight={700}>
                                GeoPackage Catalog
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Files live once in `data/`. VRT sets reference these catalog entries instead of copying them.
                              </Typography>
                            </Box>
                          </Stack>

                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            spacing={1.5}
                            justifyContent="space-between"
                            alignItems={{ xs: "stretch", sm: "center" }}
                            sx={{ mb: 2 }}
                          >
                            <Typography variant="body2" color="text.secondary">
                              Upload once, then reuse the same GeoPackage in any number of VRT sets.
                            </Typography>
                            <Button
                              component="label"
                              variant="contained"
                              startIcon={<CloudUploadOutlinedIcon />}
                              disabled={isUploadingShared || isManagingShared}
                            >
                              Upload to Catalog
                              <input
                                hidden
                                type="file"
                                accept=".gpkg"
                                onChange={(event) => {
                                  void handleSharedUpload(event.target.files);
                                  event.target.value = "";
                                }}
                              />
                            </Button>
                          </Stack>

                          <TableContainer sx={{ width: "100%", overflowX: "auto" }}>
                            <Table size="small" sx={{ minWidth: 1120 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>File</TableCell>
                                  <TableCell>Path</TableCell>
                                  <TableCell>Used By</TableCell>
                                  <TableCell>Size</TableCell>
                                  <TableCell align="right">Manage</TableCell>
                                  <TableCell align="right">Use in Draft</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {availableFiles.map((file) => {
                                  const usedAsMap = maps.some((item) => item.key === `existing:${file.relativePath}`);
                                  const usedAsDtm = dtms.some((item) => item.key === `existing:${file.relativePath}`);

                                  return (
                                    <TableRow key={file.relativePath}>
                                      <TableCell sx={{ minWidth: 180, whiteSpace: "nowrap" }}>{file.fileName}</TableCell>
                                      <TableCell sx={{ minWidth: 260 }}>
                                        <Typography variant="caption">{file.relativePath}</Typography>
                                      </TableCell>
                                      <TableCell sx={{ minWidth: 180 }}>
                                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                          {file.referencedBySets.length ? (
                                            <Tooltip title={file.referencedBySets.join(", ")}>
                                              <Chip size="small" label={`${file.referencedBySets.length} set(s)`} />
                                            </Tooltip>
                                          ) : (
                                            <Typography variant="caption" color="text.secondary">
                                              Not used
                                            </Typography>
                                          )}
                                          {file.managedBySet ? <Chip size="small" variant="outlined" label="Managed path" /> : null}
                                        </Stack>
                                      </TableCell>
                                      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatFileSize(file.size)}</TableCell>
                                      <TableCell align="right" sx={{ minWidth: 250 }}>
                                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                                          <Button
                                            size="small"
                                            variant="text"
                                            startIcon={<DownloadOutlinedIcon />}
                                            component="a"
                                            href={getSharedGpkgDownloadUrl(file.relativePath)}
                                          >
                                            Download
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            startIcon={<DriveFileRenameOutlineIcon />}
                                            onClick={() => openRenameDialog(file)}
                                            disabled={isManagingShared}
                                          >
                                            Rename
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            color="error"
                                            startIcon={<DeleteOutlineIcon />}
                                            onClick={() => setDeleteTarget(file)}
                                            disabled={isManagingShared}
                                          >
                                            Delete
                                          </Button>
                                        </Stack>
                                      </TableCell>
                                      <TableCell align="right" sx={{ minWidth: 180, whiteSpace: "nowrap" }}>
                                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                                          <Button
                                            size="small"
                                            variant={usedAsMap ? "contained" : "outlined"}
                                            startIcon={<AddIcon />}
                                            disabled={usedAsMap}
                                            onClick={() => addExistingAsset("map", file)}
                                          >
                                            Map
                                          </Button>
                                          <Button
                                            size="small"
                                            variant={usedAsDtm ? "contained" : "outlined"}
                                            color="secondary"
                                            startIcon={<AddIcon />}
                                            disabled={usedAsDtm}
                                            onClick={() => addExistingAsset("dtm", file)}
                                          >
                                            DTM
                                          </Button>
                                        </Stack>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                                {!availableFiles.length ? (
                                  <TableRow>
                                    <TableCell colSpan={6}>
                                      <Typography color="text.secondary">
                                        No `.gpkg` files are available in the catalog yet.
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>

                      <Box>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                          Selected Maps
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {maps.map((item) => (
                            <Chip
                              key={item.key}
                              label={`${item.label} | ${formatFileSize(item.size)} | ${item.source}`}
                              onDelete={() => removeDraftAsset("map", item.key)}
                            />
                          ))}
                          {!maps.length ? <Chip label="No maps selected yet" variant="outlined" /> : null}
                        </Stack>
                      </Box>

                      <Box>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                          Selected DTM Layers
                        </Typography>
                        <List disablePadding>
                          {dtms.map((item, index) => (
                            <ListItem
                              key={item.key}
                              sx={{
                                mb: 1,
                                borderRadius: 3,
                                bgcolor: "background.default",
                                border: "1px solid rgba(15, 118, 110, 0.08)"
                              }}
                              secondaryAction={
                                <Stack direction="row" spacing={1}>
                                  <Tooltip title="Move up">
                                    <span>
                                      <IconButton onClick={() => reorderDraftDtms(index, -1)} disabled={index === 0}>
                                        <ArrowUpwardIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                  <Tooltip title="Move down">
                                    <span>
                                      <IconButton
                                        onClick={() => reorderDraftDtms(index, 1)}
                                        disabled={index === dtms.length - 1}
                                      >
                                        <ArrowDownwardIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                  <Tooltip title="Remove">
                                    <IconButton onClick={() => removeDraftAsset("dtm", item.key)}>
                                      <DeleteOutlineIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              }
                            >
                              <ListItemText
                                primary={`${index + 1}. ${item.label}`}
                                secondary={`Priority ${index + 1} | ${formatFileSize(item.size)} | ${item.source}`}
                              />
                            </ListItem>
                          ))}
                          {!dtms.length ? (
                            <ListItem
                              sx={{
                                borderRadius: 3,
                                bgcolor: "background.default",
                                border: "1px dashed rgba(15, 118, 110, 0.18)"
                              }}
                            >
                              <ListItemText
                                primary="No DTM layers selected yet."
                                secondary="Choose from data/ or upload new GeoPackages, then keep the highest-resolution item first."
                              />
                            </ListItem>
                          ) : null}
                        </List>
                      </Box>

                      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                        <Button type="submit" variant="contained" disabled={isSaving || !name || dtms.length === 0}>
                          Create VRT Set
                        </Button>
                        <Button
                          type="button"
                          variant="outlined"
                          disabled={isSaving || !selectedSet || (maps.length === 0 && dtms.length === 0)}
                          onClick={() => void handleAddDraftToSelectedSet()}
                        >
                          Update Selected VRT Set
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                </CardContent>
              </Card>
            </Stack>

            <Card>
              <CardContent>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                  <Box>
                    <Typography variant="h6">DTM Priority Editor</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Selected set: {selectedSet?.name ?? "None"}
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    disabled={!selectedSet || isSaving}
                    onClick={() => void handlePersistOrder()}
                  >
                    Save DTM Order
                  </Button>
                </Stack>

                <Stack direction={{ xs: "column", lg: "row" }} spacing={3} sx={{ mt: 3 }}>
                  <Box sx={{ flex: 1.1 }}>
                    <List disablePadding>
                      {orderedLayers.map((layer, index) => (
                        <ListItem
                          key={layer.id}
                          sx={{
                            mb: 1,
                            borderRadius: 3,
                            bgcolor: "background.default",
                            border: "1px solid rgba(15, 118, 110, 0.08)"
                          }}
                          secondaryAction={
                            <Stack direction="row" spacing={1}>
                              <IconButton onClick={() => reorderSelectedSet(index, -1)} disabled={index === 0}>
                                <ArrowUpwardIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                onClick={() => reorderSelectedSet(index, 1)}
                                disabled={index === orderedLayers.length - 1}
                              >
                                <ArrowDownwardIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          }
                        >
                          <ListItemText
                            primary={`${index + 1}. ${layer.originalName}`}
                            secondary={`Stored as ${layer.storedName}`}
                          />
                        </ListItem>
                      ))}
                      {!orderedLayers.length ? (
                        <ListItem
                          sx={{
                            borderRadius: 3,
                            bgcolor: "background.default",
                            border: "1px dashed rgba(15, 118, 110, 0.18)"
                          }}
                        >
                          <ListItemText
                            primary="Select a map set to edit DTM ordering."
                            secondary="The highest-resolution layers should remain at the top of the list."
                          />
                        </ListItem>
                      ) : null}
                    </List>
                  </Box>

                  <Box sx={{ flex: 0.9 }}>
                    <Stack spacing={2}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight={700}>
                            Reference-Based Composer
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            VRT sets store references to catalog files. Reordering DTMs changes precedence in the generated VRT XML.
                          </Typography>
                        </CardContent>
                      </Card>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight={700}>
                            Selected Set Summary
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Maps: {selectedSet?.maps.length ?? 0}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            DTMs: {selectedSet?.dtmLayers.length ?? 0}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            VRT: {selectedSet?.vrtPath ?? "N/A"}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Box>
      </Box>
      <Dialog
        open={Boolean(renameTarget)}
        onClose={() => {
          if (!isManagingShared) {
            setRenameTarget(null);
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Rename Shared GeoPackage</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Renaming updates any existing map-set references that point to this shared file.
            </Typography>
            <TextField
              label="File Name"
              value={nextSharedFileName}
              onChange={(event) => setNextSharedFileName(event.target.value)}
              fullWidth
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)} disabled={isManagingShared}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleRenameSharedFile()}
            variant="contained"
            disabled={isManagingShared || !nextSharedFileName.trim()}
          >
            Save Name
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!isManagingShared) {
            setDeleteTarget(null);
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Delete Shared GeoPackage</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Delete {deleteTarget?.fileName}? If this file is already used by a map set, deletion will be blocked until
            those references are removed first.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={isManagingShared}>
            Cancel
          </Button>
          <Button onClick={() => void handleDeleteSharedFile()} color="error" variant="contained" disabled={isManagingShared}>
            Delete File
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
