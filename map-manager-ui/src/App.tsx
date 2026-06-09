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
  MenuItem,
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
  deleteSharedDtm,
  deleteSharedGpkg,
  fetchAvailableDtms,
  fetchAvailableGpkgs,
  fetchSets,
  getSharedDtmDownloadUrl,
  getSharedGpkgDownloadUrl,
  renameSharedDtm,
  renameSharedGpkg,
  updateDtmOrder,
  uploadSharedDtm,
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
  const [availableMapFiles, setAvailableMapFiles] = useState<AvailableGpkgFile[]>([]);
  const [availableDtmFiles, setAvailableDtmFiles] = useState<AvailableGpkgFile[]>([]);
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
  const [renameTarget, setRenameTarget] = useState<{ kind: "map" | "dtm"; file: AvailableGpkgFile } | null>(null);
  const [nextSharedFileName, setNextSharedFileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "map" | "dtm"; file: AvailableGpkgFile } | null>(null);
  const [serverOrder, setServerOrder] = useState<Record<string, string[]>>({});

  const selectedSet = sets.find((item) => item.id === selectedSetId) ?? null;

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard(preferredSelectedSetId?: string) {
    setIsLoading(true);
    setError("");

    try {
      const [nextSets, nextMapFiles, nextDtmFiles] = await Promise.all([
        fetchSets(),
        fetchAvailableGpkgs(),
        fetchAvailableDtms()
      ]);
      setSets(nextSets);
      setAvailableMapFiles(nextMapFiles);
      setAvailableDtmFiles(nextDtmFiles);
      setSelectedSetId((current) => {
        if (preferredSelectedSetId && nextSets.some((item) => item.id === preferredSelectedSetId)) {
          return preferredSelectedSetId;
        }

        if (current && nextSets.some((item) => item.id === current)) {
          return current;
        }

        return nextSets[0]?.id || "";
      });
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

      await loadDashboard(created.id);
      resetDraftSelection();
      setSuccess(created.dtmLayers.length ? "Map set created and VRT generated." : "Map set created without DTM layers.");
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
      await loadDashboard(updated.id);
      resetDraftSelection();
      setSuccess(
        updated.dtmLayers.length
          ? `Added assets to "${updated.name}" and rebuilt the VRT.`
          : `Added assets to "${updated.name}" without DTM layers.`
      );
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

    if (selectedSet.dtmLayers.length === 0) {
      setError("");
      setSuccess(`"${selectedSet.name}" has no DTM layers to reorder.`);
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
      await loadDashboard();
      setSuccess("Map set deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete map set.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSharedUpload(kind: "map" | "dtm", fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    setIsUploadingShared(true);
    setError("");
    setSuccess("");

    try {
      const upload = kind === "map" ? uploadSharedGpkg : uploadSharedDtm;
      const uploaded = await upload(file);
      const setter = kind === "map" ? setAvailableMapFiles : setAvailableDtmFiles;

      setter((current) =>
        [...current.filter((item) => item.relativePath !== uploaded.relativePath), uploaded].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )
      );
      setSuccess(`Uploaded ${uploaded.fileName} to shared GeoPackages.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload shared raster.");
    } finally {
      setIsUploadingShared(false);
    }
  }

  function openRenameDialog(kind: "map" | "dtm", file: AvailableGpkgFile) {
    setRenameTarget({ kind, file });
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
      const rename = renameTarget.kind === "map" ? renameSharedGpkg : renameSharedDtm;
      const updated = await rename(renameTarget.file.relativePath, nextSharedFileName);
      const setFiles = renameTarget.kind === "map" ? setAvailableMapFiles : setAvailableDtmFiles;
      setFiles((current) =>
        current
          .map((item) => (item.relativePath === renameTarget.file.relativePath ? updated : item))
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      );
      setMaps((current) =>
        current.map((item) =>
          item.relativePath === renameTarget.file.relativePath
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
          item.relativePath === renameTarget.file.relativePath
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
      await loadDashboard();
      setRenameTarget(null);
      setNextSharedFileName("");
      setSuccess(`Renamed shared GeoPackage to ${updated.fileName}.`);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename shared raster.");
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
      const deleteFile = deleteTarget.kind === "map" ? deleteSharedGpkg : deleteSharedDtm;
      await deleteFile(deleteTarget.file.relativePath);
      const setFiles = deleteTarget.kind === "map" ? setAvailableMapFiles : setAvailableDtmFiles;
      setFiles((current) => current.filter((item) => item.relativePath !== deleteTarget.file.relativePath));
      setMaps((current) => current.filter((item) => item.relativePath !== deleteTarget.file.relativePath));
      setDtms((current) => current.filter((item) => item.relativePath !== deleteTarget.file.relativePath));
      setDeleteTarget(null);
      setSuccess(`Deleted shared GeoPackage ${deleteTarget.file.fileName}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete shared raster.");
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
            <ListItemText primary="Map Set Manager" secondary="Pick, upload, and optionally order DTMs" />
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
                Shared `data/` source of truth, optional DTM priority, generated GDAL VRT output.
              </Typography>
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ px: 2.5, py: 3, maxWidth: 1400, mx: "auto" }}>
          <Stack spacing={3}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {success ? <Alert severity="success">{success}</Alert> : null}

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
                    <TextField
                      select
                      label="Active Set"
                      value={selectedSetId}
                      onChange={(event) => setSelectedSetId(event.target.value)}
                      fullWidth
                      helperText={selectedSet ? selectedSet.description || "No description" : "Choose a set to edit"}
                    >
                      {sets.map((mapSet) => (
                        <MenuItem key={mapSet.id} value={mapSet.id}>
                          {mapSet.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Stack direction="row" spacing={1.5}>
                      <Button variant="outlined" onClick={() => void loadDashboard()} disabled={isLoading}>
                        Refresh
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => void handleDeleteSet(selectedSetId)}
                        disabled={!selectedSet || isSaving}
                      >
                        Delete Set
                      </Button>
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={`Sets: ${sets.length}`} variant="outlined" />
                    <Chip label={`Maps: ${selectedSet?.maps.length ?? 0}`} variant="outlined" />
                    <Chip label={`DTMs: ${selectedSet?.dtmLayers.length ?? 0}`} variant="outlined" />
                    <Chip
                      label={
                        selectedSet
                          ? selectedSet.dtmLayers.length
                            ? "VRT ready"
                            : "Map-only set"
                          : "No set selected"
                      }
                      variant="outlined"
                    />
                  </Stack>
                  </Stack>
                </CardContent>
              </Card>

            <Stack direction={{ xs: "column", xl: "row" }} spacing={3} alignItems="stretch">
              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="h6">Create Map Set</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    First ingest map GeoPackages into the shared catalog. Add DTM GeoPackages only when the set needs terrain data, then compose the set in the order you want.
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
                          Upload DTM GeoPackages to Catalog
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
                                Map GeoPackage Catalog
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Files live once in `data/`. Map sets reference these GeoPackages instead of copying them.
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
                              Upload once, then reuse the same map GeoPackage in any number of VRT sets.
                            </Typography>
                            <Button
                              component="label"
                              variant="contained"
                              startIcon={<CloudUploadOutlinedIcon />}
                              disabled={isUploadingShared || isManagingShared}
                            >
                              Upload Map GeoPackage
                              <input
                                hidden
                                type="file"
                                accept=".gpkg"
                                onChange={(event) => {
                                  void handleSharedUpload("map", event.target.files);
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
                                {availableMapFiles.map((file) => {
                                  const usedAsMap = maps.some((item) => item.key === `existing:${file.relativePath}`);

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
                                            onClick={() => openRenameDialog("map", file)}
                                            disabled={isManagingShared}
                                          >
                                            Rename
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            color="error"
                                            startIcon={<DeleteOutlineIcon />}
                                            onClick={() => setDeleteTarget({ kind: "map", file })}
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
                                        </Stack>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                                {!availableMapFiles.length ? (
                                  <TableRow>
                                    <TableCell colSpan={6}>
                                      <Typography color="text.secondary">
                                        No map GeoPackages are available in the catalog yet.
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>

                      <Card variant="outlined">
                        <CardContent sx={{ pb: "16px !important" }}>
                          <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 1.5 }}>
                            <FolderOutlinedIcon fontSize="small" />
                            <Box>
                          <Typography variant="subtitle1" fontWeight={700}>
                                DTM GeoPackage Catalog
                              </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Files live once in `data/dtms/`. Add them only when a set needs terrain layers; otherwise the set can remain map-only.
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
                              Upload once, then reuse the same DTM GeoPackage in any number of sets that need it.
                            </Typography>
                            <Button
                              component="label"
                              variant="contained"
                              color="secondary"
                              startIcon={<CloudUploadOutlinedIcon />}
                              disabled={isUploadingShared || isManagingShared}
                            >
                              Upload DTM GeoPackage
                              <input
                                hidden
                                type="file"
                                accept=".gpkg"
                                onChange={(event) => {
                                  void handleSharedUpload("dtm", event.target.files);
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
                                {availableDtmFiles.map((file) => {
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
                                            href={getSharedDtmDownloadUrl(file.relativePath)}
                                          >
                                            Download
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            startIcon={<DriveFileRenameOutlineIcon />}
                                            onClick={() => openRenameDialog("dtm", file)}
                                            disabled={isManagingShared}
                                          >
                                            Rename
                                          </Button>
                                          <Button
                                            size="small"
                                            variant="text"
                                            color="error"
                                            startIcon={<DeleteOutlineIcon />}
                                            onClick={() => setDeleteTarget({ kind: "dtm", file })}
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
                                {!availableDtmFiles.length ? (
                                  <TableRow>
                                    <TableCell colSpan={6}>
                                      <Typography color="text.secondary">
                                        No DTM GeoPackages are available in the catalog yet.
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
                                secondary="That's okay — create a map-only set, or add GeoPackages here later if you need terrain priority."
                              />
                            </ListItem>
                          ) : null}
                        </List>
                      </Box>

                      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                        <Button type="submit" variant="contained" disabled={isSaving || !name || maps.length === 0}>
                          Create Map Set
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
                    disabled={!selectedSet || isSaving || (selectedSet?.dtmLayers.length ?? 0) === 0}
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
                            primary={
                              selectedSet
                                ? "This set has no DTM layers yet."
                                : "Select a map set to edit DTM ordering."
                            }
                            secondary={
                              selectedSet
                                ? "Map-only sets are valid. Add DTM GeoPackages later if you need elevation-aware terrain layers."
                                : "The highest-resolution layers should remain at the top of the list."
                            }
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
                            VRT: {selectedSet ? (selectedSet.dtmLayers.length ? selectedSet.vrtPath : "N/A (map-only set)") : "N/A"}
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
        <DialogTitle>Rename Shared Raster</DialogTitle>
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
        <DialogTitle>Delete Shared Raster</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Delete {deleteTarget?.file.fileName}? If this file is already used by a map set, deletion will be blocked
            until those references are removed first.
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
